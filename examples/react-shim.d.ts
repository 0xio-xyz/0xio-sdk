declare module 'react' {
  export function useState<S>(initial: S | (() => S)): [S, (value: S | ((prev: S) => S)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useRef<T>(initial: T): { current: T };
}

declare module 'react/jsx-runtime' {
  export const jsx: (...args: unknown[]) => unknown;
  export const jsxs: (...args: unknown[]) => unknown;
  export const Fragment: unknown;
}

declare namespace JSX {
  interface Element {}
  interface IntrinsicElements {
    [name: string]: Record<string, unknown>;
  }
}
