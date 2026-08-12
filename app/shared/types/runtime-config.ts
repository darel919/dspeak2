export interface PublicRuntimeConfigShape {
  apiPath?: string;
  baseApiPath?: string;
}

export interface RuntimeConfigShape {
  public?: PublicRuntimeConfigShape;
}
