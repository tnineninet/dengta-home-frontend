export function resizeComposerInput(input) {
  if (!input) return;
  const view = input.ownerDocument.defaultView;
  const style = view.getComputedStyle(input);
  const minimum = Number.parseFloat(style.minHeight) || 44;
  const maximum = Number.parseFloat(style.maxHeight) || 176;
  // A wrapped placeholder contributes to scrollHeight on narrow WebViews.
  // An empty draft must still return to the single-line resting height.
  if (input.value === "") {
    input.style.height = `${minimum}px`;
    input.style.overflowY = "hidden";
    return;
  }
  input.style.height = "0px";
  const contentHeight = input.scrollHeight;
  input.style.height = `${Math.min(maximum, Math.max(minimum, contentHeight))}px`;
  input.style.overflowY = contentHeight > maximum ? "auto" : "hidden";
}
