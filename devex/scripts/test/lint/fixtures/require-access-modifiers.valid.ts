// @ts-nocheck
export class Foo {
  public x = 1;
  readonly #y = "hello";
  #privateField = true;
  public method(): void {}
  async #asyncMethod(): Promise<void> {}
  public constructor() {}
}
