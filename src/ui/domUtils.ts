export function setInputIfNotFocused(id: string, value: string): void {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (el && el !== document.activeElement) el.value = value;
}
