# VST Plugin Design

*Scope: VISUAL design of audio plugin UIs (VST/VST3/AU) - DAW-hosted windows, knobs/faders/
meters, skeuomorphic vs flat, fixed vs scalable UI, host constraints. Do NOT confuse with
desktop-app.md (standalone apps) - a plugin UI lives inside a host it does not control.*

## Rules

- [w51JhF] VST2 presets .fxp/.fxb share one header format - 'CcnK' magic, 'FPCh' chunk, and a 4CC plugin id at bytes 16-19 - the 4CC identifies the owning synth even when the extension is shared by many plugins; build the id map by correlating 4CCs from presets inside folders whose names name the synth.

## Gotchyas

## Issues & Solutions
