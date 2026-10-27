/** Native build failure with no remote publication. */
export class ClientBuildError extends Error { readonly code: string }
/** Resolve the native target or throw before any package build starts. */
export function resolveClientBuildTarget(input: string, platform?: NodeJS.Platform, arch?: string): 'win-x64' | 'win-arm64' | 'mac-arm64' | 'mac-x64'
/** Delegate package options without requiring or manufacturing an update feed. */
export function clientBuildArguments(args: string[], platform?: NodeJS.Platform, arch?: string): string[]
