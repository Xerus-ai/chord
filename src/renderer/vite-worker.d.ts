/** Vite's `?worker` import: the module's default export constructs the bundled worker. */
declare module '*?worker' {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}
