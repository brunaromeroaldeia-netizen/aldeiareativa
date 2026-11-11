export const fileURLToPath = () => '/app/server/config.js';
export const pathToFileURL = (p) => ({ href: `file://${p}` });
export default { fileURLToPath, pathToFileURL };
