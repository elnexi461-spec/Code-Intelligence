import type { EngineStateValue } from './types.js';

/** Valid transitions: idle→running, running→paused, paused→running,
 *  running→stopping, paused→stopping, stopping→stopped */
const ALLOWED: Record<EngineStateValue, EngineStateValue[]> = {
  idle:     ['running'],
  running:  ['paused', 'stopping'],
  paused:   ['running', 'stopping'],
  stopping: ['stopped'],
  stopped:  [],
};

export class EngineState {
  private _value: EngineStateValue = 'idle';

  get value(): EngineStateValue {
    return this._value;
  }

  is(state: EngineStateValue): boolean {
    return this._value === state;
  }

  canTransitionTo(next: EngineStateValue): boolean {
    return ALLOWED[this._value]?.includes(next) ?? false;
  }

  transition(next: EngineStateValue): EngineStateValue {
    if (!this.canTransitionTo(next)) {
      throw new Error(`Invalid state transition: ${this._value} → ${next}`);
    }
    const prev = this._value;
    this._value = next;
    return prev;
  }
}
