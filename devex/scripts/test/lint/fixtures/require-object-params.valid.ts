// @ts-nocheck
export class Foo {
  public constructor({ a, b }: { a: string; b: number }) {}
  public method({ x, y }: { x: string; y: boolean }): void {}
  public singleParam(_x: string): void {}
  public noParams(): void {}
  public get value(): string {
    return "";
  }
  public set value(v: string) {}
}

export function namedFn({ a, b }: { a: string; b: number }): void {}

export const arrowFn = ({ a, b }: { a: string; b: number }): void => {};

export const callback = [1, 2].map((_x: number, _i: number) => _x);
