const $ = id => document.getElementById(id);
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
    if (tool === 'word' || tool === 'image' || tool === 'pdf-image') { window.AtlasPDFOpenConverter?.(tool); return; }
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
