// Operating inputs the per-machine-type models are trained on (MIMII DG lab
// set-points; see docs/EXPERIMENT_LOG.md EXP-003). Values are stored as
// context_readings under `name` with `unit`; `mlName` is the matching
// MIMII DG attribute the model adapter maps them to.
//
// The ranges are the training ranges. They describe the data, not machine
// health: a value outside them is shown with a notice but never blocked.

import type { Database } from "./database.types";

export type MachineType = Database["public"]["Enums"]["machine_type"];

export const MACHINE_TYPES: { value: MachineType; label: string }[] = [
  { value: "bearing", label: "Bearing" },
  { value: "gearbox", label: "Gearbox" },
  { value: "other", label: "Other" },
];

export function machineTypeLabel(type: MachineType): string {
  return MACHINE_TYPES.find((t) => t.value === type)?.label ?? type;
}

export type ModelInput = {
  name: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  mlName: string;
};

export const MODEL_INPUTS: Record<MachineType, ModelInput[]> = {
  bearing: [{ name: "speed", label: "Rotation speed", unit: "krpm", min: 2, max: 26, mlName: "vel" }],
  gearbox: [
    { name: "voltage", label: "Motor voltage", unit: "V", min: 0.6, max: 3.5, mlName: "volt" },
    { name: "weight", label: "Load weight", unit: "g", min: 0, max: 250, mlName: "wt" },
  ],
  other: [],
};

/** Names reserved for model inputs, so free-form readings cannot reuse them. */
export const RESERVED_INPUT_NAMES = new Set(Object.values(MODEL_INPUTS).flat().map((i) => i.name));

export function modelInputFor(type: MachineType, name: string): ModelInput | undefined {
  return MODEL_INPUTS[type].find((i) => i.name === name);
}

/**
 * Returns a notice when a reading the model uses falls outside its training
 * range, or null when it is inside the range or not a model input.
 */
export function rangeNotice(type: MachineType, name: string, value: number, unit: string): string | null {
  const input = modelInputFor(type, name);
  if (!input || unit !== input.unit || !Number.isFinite(value)) return null;
  if (value >= input.min && value <= input.max) return null;
  return `Outside the conditions represented in the ${type} test data (${input.min}–${input.max} ${input.unit}). The value is stored as entered; the acoustic model does not use it.`;
}
