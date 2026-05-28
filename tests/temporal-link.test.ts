import { describe, it, expect, beforeEach } from 'vitest';
import {
  setLinkMode,
  isLinkMode,
  setFrameRate,
  setShutterDenom,
  setTemporalFrameRate,
  setTemporalShutterDenom,
  setRegionHz,
  setTemporalRegionHz,
  setTemporalVelocityOnly,
  setTemporalVelocity,
  getFrameRate,
  getShutterDenom,
  getEffectiveFrameRate,
  getEffectiveShutterDenom,
  getEffectiveVelocity,
  getEffectiveRegionHz,
} from '../src/temporalState';

describe('temporal link mode', () => {
  beforeEach(() => {
    setLinkMode(false);
    setRegionHz(0);
    setFrameRate(30);
    setShutterDenom(60);
    setTemporalRegionHz(0);
    setTemporalFrameRate(24);
    setTemporalShutterDenom(48);
    setTemporalVelocityOnly(2);
    setTemporalVelocity(1.5);
  });

  it('starts unlinked with independent spatial and temporal timing', () => {
    expect(isLinkMode()).toBe(false);
    expect(getFrameRate()).toBe(30);
    expect(getEffectiveFrameRate()).toBe(24);
    expect(getShutterDenom()).toBe(60);
    expect(getEffectiveShutterDenom()).toBe(48);
    expect(getEffectiveRegionHz()).toBe(0);
    expect(getEffectiveVelocity()).toBe(2);
  });

  it('spatial shutter changes do not affect temporal shutter when unlinked', () => {
    setRegionHz(0);
    setShutterDenom(120);
    expect(getShutterDenom()).toBe(120);
    expect(getEffectiveShutterDenom()).toBe(48);
  });

  it('temporal shutter changes do not affect spatial shutter when unlinked', () => {
    setTemporalShutterDenom(96);
    expect(getEffectiveShutterDenom()).toBe(96);
    expect(getShutterDenom()).toBe(60);
  });

  it('linking copies spatial timing into temporal copies', () => {
    setLinkMode(true);
    expect(getEffectiveFrameRate()).toBe(30);
    expect(getEffectiveShutterDenom()).toBe(60);
    expect(getEffectiveRegionHz()).toBe(0);
    expect(getEffectiveVelocity()).toBe(1.5);
  });

  it('linked spatial shutter updates propagate to effective temporal shutter', () => {
    setLinkMode(true);
    setShutterDenom(240);
    expect(getShutterDenom()).toBe(240);
    expect(getEffectiveShutterDenom()).toBe(240);
  });

  it('spatial fps changes propagate to effective fps when linked', () => {
    setLinkMode(true);
    setFrameRate(50);
    expect(getEffectiveFrameRate()).toBe(50);
  });
});
