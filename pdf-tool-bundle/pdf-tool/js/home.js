const $ = id => document.getElementById(id);

// Show the current date using the Ethiopian calendar and Amharic locale.
function updateEthiopianHeaderDate() {
  const dateElement = $('ethiopianDate');
  if (!dateElement) return;
  const now = new Date();
  try {
    dateElement.textContent = new Intl.DateTimeFormat('am-ET-u-ca-ethiopic', {
      day: 'numeric', month: 'long', year: 'numeric'
    }).format(now);
  } catch (error) {
    dateElement.textContent = new Intl.DateTimeFormat('en-US-u-ca-ethiopic', {
      day: 'numeric', month: 'long', year: 'numeric'
    }).format(now);
  }
  dateElement.dateTime = now.toISOString();
}
updateEthiopianHeaderDate();
setInterval(updateEthiopianHeaderDate, 60 * 60 * 1000);

const hub = $('homeHub');
const workspace = $('documentWorkspace');
const picker = $('picker');
let pendingTool = null;

function syncHome() {
  const empty = !!workspace?.hidden;
  document.body.classList.toggle('home-empty', empty);
  if (hub) hub.hidden = !empty;
}
const observer = new MutationObserver(() => {
  syncHome();
  if (!workspace.hidden && pendingTool) {
    const action = pendingTool;
    pendingTool = null;
    requestAnimationFrame(() => {
      if (action === 'edit') $('previewEdit')?.click();
      if (action === 'organize') $('organizePages')?.click();
      if (action === 'split') $('organizePages')?.click();
      if (action === 'compress') $('quality')?.focus();
    });
  }
});
observer.observe(workspace, { attributes: true, attributeFilter: ['hidden'] });
syncHome();
// Release the first-paint guard only after the initial layout state is applied.
document.documentElement.classList.add('atlas-ui-ready');

document.querySelectorAll('[data-home-tool]').forEach(button => {
  button.addEventListener('click', () => {
    const tool = button.dataset.homeTool;
    if (tool === 'unlock') { $('unlockTool').click(); return; }
    if (tool === 'word' || tool === 'image' || tool === 'pdf-image' || tool === 'pdf-word') { window.AtlasPDFOpenConverter?.(tool); return; }
    if (tool === 'repair') { window.AtlasPDFOpenRepair?.(); return; }
    if (tool === 'ocr') { window.AtlasPDFOpenOCR?.(); return; }
    if (tool === 'sign') { window.AtlasPDFOpenSign?.(); return; }
    if (tool === 'protect') { window.AtlasPDFOpenProtect?.(); return; }
    pendingTool = tool === 'merge' ? null : tool;
    picker.multiple = tool === 'merge';
    picker.click();
  });
});

// The existing app owns PDF loading. Restore the multi-file picker after its
// onchange handler has consumed the selected FileList.
picker.addEventListener('change', () => {
  setTimeout(() => { picker.multiple = true; }, 0);
});
