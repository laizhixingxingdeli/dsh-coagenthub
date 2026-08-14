/** CSS Modules declaration for the client UI (bundler inlines the styles). */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
