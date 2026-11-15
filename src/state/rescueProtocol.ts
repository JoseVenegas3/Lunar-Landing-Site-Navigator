/** Messages between the rescue hook and its Web Worker. */
import type { DemStack, HorizonProfile, MissionInput, RescueOptions, RescueResult, Verdict } from '../engine';

export interface RescueRequest {
  id: number;
  dem: DemStack;
  input: MissionInput;
  horizon: HorizonProfile;
  before: Verdict;
  options: RescueOptions;
}

export type RescueReply =
  | { id: number; kind: 'progress'; progress: number }
  | { id: number; kind: 'done'; result: RescueResult }
  | { id: number; kind: 'error'; message: string };
