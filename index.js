#!/usr/bin/env node
import { createAdapter } from './lib/runtime/adapter-loader.js';
import { runService } from './lib/runtime/service.js';

runService({ adapterFactory: createAdapter });
