import { probarContratoPosStore } from './contrato'
import { crearStoreEnMemoria } from './memoria'

probarContratoPosStore(async () => crearStoreEnMemoria())
