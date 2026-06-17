// esbuild loads .css entries as raw text strings.
declare module "*.css" {
  const content: string;
  export default content;
}
