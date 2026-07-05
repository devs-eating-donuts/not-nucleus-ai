import type { OpsCadence, TestingCadence } from './bullpen';

/** Valid for both TestingCadence and SecurityCadence (same value set). */
export function isTestingCadence(value: unknown): value is TestingCadence {
  return value === 'afterEachTask' || value === 'endOfPhase' || value === 'off';
}

export function isOpsCadence(value: unknown): value is OpsCadence {
  return value === 'endOfPhase' || value === 'endOfProject' || value === 'off';
}
