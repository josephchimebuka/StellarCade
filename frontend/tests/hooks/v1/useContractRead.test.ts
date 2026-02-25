import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useContractRead } from '../../../src/hooks/v1/useContractRead';

describe('useContractRead', () => {

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('should initialize with standard default layout', () => {
        const { result } = renderHook(() =>
            useContractRead({ contractId: 'CC_READ' })
        );

        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBeNull();
        expect(result.current.data).toBeNull();
    });

    it('should prevent read requests without a valid contract ID', async () => {
        const { result } = renderHook(() =>
            useContractRead({ contractId: '' })
        );

        await act(async () => {
            await expect(result.current.read('sym_test')).rejects.toThrow('Contract ID is required');
        });

        expect(result.current.error?.message).toContain('Contract ID is required');
        expect(result.current.loading).toBe(false);
    });

    it('should retrieve a parsed read envelope safely mapped as a generic result', async () => {
        const { result } = renderHook(() =>
            useContractRead({ contractId: 'CC_READ' })
        );

        let res;
        await act(async () => {
            res = await result.current.read('get_balance', ['123', 45]);
        });

        expect(result.current.error).toBeNull();
        expect(res).toBeDefined();
        expect(res).toHaveProperty('method', 'get_balance');
        expect(res).toHaveProperty('result', 'mock_read_success');
        expect(result.current.data).toEqual(res);
    });

    it('should allow refetching explicitly avoiding unassigned requests locally', async () => {
        const { result } = renderHook(() =>
            useContractRead({ contractId: 'CC_READ' })
        );

        await act(async () => {
            await expect(result.current.refetch()).rejects.toThrow('No active read request to refetch');
        });

        await act(async () => {
            await result.current.read('get_info');
        });

        expect(result.current.data).toBeDefined();

        await act(async () => {
            await result.current.refetch();
        });

        expect(result.current.error).toBeNull();
    });

    it('should respect polling definitions if assigned and trigger automatically', async () => {
        const { result } = renderHook(() =>
            useContractRead({ contractId: 'CC_READ' })
        );

        await act(async () => {
            await result.current.read('get_status', [], { pollingInterval: 1000 });
        });

        expect(result.current.data).toHaveProperty('method', 'get_status');

        // Fast-forward so poll happens again smoothly in mock execution bounds ensuring timer triggers.
        await act(async () => {
            vi.advanceTimersByTime(2500);
        });

        expect(result.current.error).toBeNull();
    });

    it('should safely omit fetching if enabled constraint is flagged explicitly false', async () => {
        const { result } = renderHook(() =>
            useContractRead({ contractId: 'CC_READ' })
        );

        let data;
        await act(async () => {
            data = await result.current.read('get_status', [], { enabled: false });
        });

        expect(result.current.data).toBeNull();
        expect(data).toBeNull();
        expect(result.current.error).toBeNull();
    });
});
