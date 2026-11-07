/** Images are embedded by the shared Client compiler. */
declare module '*.png' {
  const url: string
  export default url
}
