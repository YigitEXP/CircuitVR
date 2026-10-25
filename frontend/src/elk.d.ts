declare module 'elkjs/lib/elk.bundled.js' {
  const ELK: new () => {
    layout: (graph: any) => Promise<any>;
  };
  export default ELK;
}
