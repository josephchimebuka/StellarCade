import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useContractEvents } from '../../../src/hooks/v1/useContractEvents';

describe('useContractEvents', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('should initialize with default state', () => {
        const { result } = renderHook(() =>
            useContractEvents({ contractId: 'CC_TEST123', autoStart: false })
        );

        expect(result.current.events).toEqual([]);
        expect(result.current.isListening).toBe(false);
        expect(result.current.error).toBeNull();
    });

    it('should error when starting without contractId', () => {
        const { result } = renderHook(() =>
            useContractEvents({ contractId: '', autoStart: false })
        );

        act(() => {
            result.current.start();
        });

        expect(result.current.error).toBeInstanceOf(Error);
        expect(result.current.error?.message).toBe('Contract ID is required to listen for events');
        expect(result.current.isListening).toBe(false);
    });

    it('should auto start if configured', () => {
        const { result } = renderHook(() =>
            useContractEvents({ contractId: 'CC_TEST123', autoStart: true })
        );

        // Initial render sets listening
        expect(result.current.isListening).toBe(true);
        expect(result.current.error).toBeNull();
    });

    it('can be manually started and stopped', () => {
        const { result } = renderHook(() =>
            useContractEvents({ contractId: 'CC_TEST123', autoStart: false })
        );

        act(() => {
            result.current.start();
        });
        expect(result.current.isListening).toBe(true);

        act(() => {
            result.current.stop();
        });
        expect(result.current.isListening).toBe(false);
    });

    it('clears state correctly', () => {
        const { result } = renderHook(() =>
            useContractEvents({ contractId: 'CC_TEST123', autoStart: false })
        );

        act(() => {
            result.current.clear();
        });

        expect(result.current.events).toEqual([]);
        expect(result.current.error).toBeNull();
    });
});
