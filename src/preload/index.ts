import { contextBridge } from 'electron';
import { nucleusApi } from './api';

contextBridge.exposeInMainWorld('nucleus', nucleusApi);
