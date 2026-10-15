import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const mock = fileURLToPath(new URL('./mock-api.js', import.meta.url));
export default defineConfig({ plugins:[react()], resolve:{ alias:[{find:/^.*\/services\/api\.js$/,replacement:mock},{find:/^\.\/api\.js$/,replacement:mock}] }, server:{host:'127.0.0.1',port:5180,strictPort:true}, publicDir:false, cacheDir:"node_modules/.vite-browser-tests" });

