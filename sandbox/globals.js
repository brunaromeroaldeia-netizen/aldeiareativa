// Precisa ser o primeiro módulo carregado: bibliotecas do servidor (SheetJS) detectam Buffer ao carregar.
import { Buffer } from 'buffer';

globalThis.Buffer = Buffer;
globalThis.global = globalThis;
