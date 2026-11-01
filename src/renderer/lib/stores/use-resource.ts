import { useEffect } from 'react';
import { useStore } from 'zustand';
import type { Resource, ResourceState } from './resource';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useResourceData<T>(resource: Resource<T, any>): ResourceState<T> {
  useEffect(() => resource.observerAttach(), [resource]);
  return useStore(resource.store);
}

export function useResourceSelector<T, R>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resource: Resource<T, any>,
  selector: (state: ResourceState<T>) => R
): R {
  useEffect(() => resource.observerAttach(), [resource]);
  return useStore(resource.store, selector);
}
