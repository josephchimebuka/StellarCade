import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useRngContract } from '../../../src/hooks/v1/useRngContract';
import { RngRequestStatus } from '../../../src/types/contracts/rng';

describe('useRngContract', () => {

    it('should initialize with standard default layout', () => {
        const { result } = renderHook(() =>
            useRngContract({ contractId: 'CC_RNG' })
        );

        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBeNull();
    });

    it('should prevent RNG requests without a valid contract ID', async () => {
        const { result } = renderHook(() =>
            useRngContract({ contractId: '', walletAddress: 'GC_WALLET' })
        );

        await act(async () => {
            await expect(result.current.requestRandomNumber()).rejects.toThrow('Contract ID is required');
        });

        expect(result.current.error?.message).toContain('Contract ID is required');
        expect(result.current.loading).toBe(false);
    });

    it('should prevent RNG requests globally if the caller has no wallet attached', async () => {
        const { result } = renderHook(() =>
            useRngContract({ contractId: 'CC_RNG', walletAddress: '' })
        );

        await act(async () => {
            await expect(result.current.requestRandomNumber()).rejects.toThrow('Wallet must be connected');
        });

        expect(result.current.error?.message).toContain('Wallet must be connected');
    });

    it('should prevent invalid options mapping constraints', async () => {
        const { result } = renderHook(() =>
            useRngContract({ contractId: 'CC_RNG', walletAddress: 'GC_WALLET' })
        );

        await act(async () => {
            await expect(result.current.requestRandomNumber({ min: 100, max: 10 })).rejects.toThrow('Minimum value cannot be greater than maximum value.');
        });

        expect(result.current.error?.message).toContain('Minimum value cannot be greater than maximum value.');
    });

    it('should successfully dispatch a deterministic RNG allocation simulation', async () => {
        const { result } = renderHook(() =>
            useRngContract({ contractId: 'CC_RNG', walletAddress: 'GC_WALLET' })
        );

        let requestId;
        await act(async () => {
            requestId = await result.current.requestRandomNumber({ min: 0, max: 200 });
        });

        expect(requestId).toBeDefined();
        expect(requestId).toMatch(/^RNG_\d+_\d+$/);
        expect(result.current.error).toBeNull();
    });

    it('should prevent fetching results mapped without valid IDs', async () => {
        const { result } = renderHook(() =>
            useRngContract({ contractId: 'CC_RNG', walletAddress: 'GC_WALLET' })
        );

        let res;
        await act(async () => {
            res = await result.current.getRequestResult('');
        });

        expect(res).toBeNull();
        expect(result.current.error?.message).toContain('Invalid RNG request ID.');
    });

    it('should execute reliable cycle transitioning results to fulfilled status successfully', async () => {
        const { result } = renderHook(() =>
            useRngContract({ contractId: 'CC_RNG', walletAddress: 'GC_WALLET' })
        );

        let requestId;
        await act(async () => {
            requestId = await result.current.requestRandomNumber();
        });

        expect(requestId).toBeTruthy();

        let fetched;
        await act(async () => {
            fetched = await result.current.getRequestResult(requestId as string);
        });

        expect(result.current.error).toBeNull();
        expect(fetched?.requestId).toBe(requestId);
        expect(fetched?.status).toBe(RngRequestStatus.Fulfilled);
        expect(fetched?.result).toBeDefined();
        expect(typeof fetched?.result).toBe('number');
    });

});
