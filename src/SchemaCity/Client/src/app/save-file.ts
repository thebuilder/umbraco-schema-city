/** Hands text to the browser as a download, the way every export in the app saves. */
export function saveFile(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Downloads consume the URL asynchronously, after the click task has ended.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
