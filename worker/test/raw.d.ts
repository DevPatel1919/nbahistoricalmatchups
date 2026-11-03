// Vite's ?raw imports: the corpus is JSON lines, read as text.
declare module "*?raw" {
  const text: string;
  export default text;
}
