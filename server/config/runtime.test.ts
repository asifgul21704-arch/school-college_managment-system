import test from 'node:test';
import assert from 'node:assert/strict';
import { isProductionEnvironment } from './runtime.ts';

test('detects Railway production even when NODE_ENV is not production', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousRailwayEnv = process.env.RAILWAY_ENVIRONMENT_NAME;
  try {
    process.env.NODE_ENV = 'test';
    process.env.RAILWAY_ENVIRONMENT_NAME = 'production';
    assert.equal(isProductionEnvironment(), true);
    process.env.RAILWAY_ENVIRONMENT_NAME = 'staging';
    assert.equal(isProductionEnvironment(), false);
    process.env.NODE_ENV = 'production';
    assert.equal(isProductionEnvironment(), true);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousRailwayEnv === undefined) delete process.env.RAILWAY_ENVIRONMENT_NAME;
    else process.env.RAILWAY_ENVIRONMENT_NAME = previousRailwayEnv;
  }
});
