// O backend usa "import XLSX from 'xlsx'" (CommonJS no Node); no navegador usamos o build ESM.
import * as XLSX from '../../node_modules/xlsx/xlsx.mjs';
export default XLSX;
