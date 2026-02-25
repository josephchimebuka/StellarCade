import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { usePrizePoolContract } from '../../../src/hooks/v1/usePrizePoolContract';

describe('usePrizePoolContract', () => {

    it('should format default states correctly locally', () => {
        const { result } = renderHook(() =>
            usePrizePoolContract({ contractId: 'CC_POOL', walletAddress: 'GC_MOCK' })
        );

        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBeNull();
    });

    it('should prevent getPoolState from dispatching without a predefined contractId', async () => {
        const { result } = renderHook(() =>
            usePrizePoolContract({ contractId: '' })
        );

        let res;
        await act(async () => {
            res = await result.current.getPoolState();
        });

        expect(res).toBeNull();
        expect(result.current.error?.message).toContain('Contract ID is required.');
    });

    it('should securely evaluate and resolve mock deterministic bounds correctly mapped from getPoolState', async () => {
        const { result } = renderHook(() =>
            usePrizePoolContract({ contractId: 'CC_POOL' })
        );

        let res;
        await act(async () => {
            res = await result.current.getPoolState();
        });

        expect(result.current.error).toBeNull();
        expect(res).toBeDefined();
        expect(res?.balance).toBe('10000');
        expect(res?.totalReserved).toBe('500');
    });

    it('should explicitly reject mutations to reserveFunds without connected wallet mappings', async () => {
        const { result } = renderHook(() =>
            usePrizePoolContract({ contractId: 'CC_POOL', walletAddress: '' })
        );

        await act(async () => {
            await expect(result.current.reserveFunds({ gameId: 'g1', amount: '10' })).rejects.toThrow('Wallet must be connected to reserve funds.');
        });

        expect(result.current.loading).toBe(false);
        expect(result.current.error?.message).toContain('Wallet must be connected');
    });

    it('should successfully reserve funds when constraints are mapped validating deterministic parameters outputting correctly', async () => {
        const { result } = renderHook(() =>
            usePrizePoolContract({ contractId: 'CC_POOL', walletAddress: 'GC_MOCK' })
        );

        let mappedState;
        await act(async () => {
            mappedState = await result.current.reserveFunds({ gameId: 'g1', amount: '25' });
        });

        expect(result.current.error).toBeNull();
        expect(mappedState?.totalReserved).toBe('525');
    });

    it('should effectively map processPayout preventing execution via explicitly wrong parsed formats locally safely', async () => {
        const { result } = renderHook(() =>
            usePrizePoolContract({ contractId: 'CC_POOL', walletAddress: 'GC_MOCK' })
        );

        await act(async () => {
            await expect(result.current.processPayout({ gameId: 'g2', amount: '', playerAddress: 'GX_TEST' })).rejects.toThrow('Invalid amount.');
        });

        expect(result.current.error?.message).toContain('Invalid amount.');
    });

    it('should accurately fulfill processPayout subtracting funds dynamically tracking explicit payloads appropriately', async () => {
        const { result } = renderHook(() =>
            usePrizePoolContract({ contractId: 'CC_POOL', walletAddress: 'GC_MOCK' })
        );

        let mappedState;
        await act(async () => {
            mappedState = await result.current.processPayout({ gameId: 'g2', amount: '50', playerAddress: 'GX_TEST' });
        });

        expect(result.current.error).toBeNull();
        expect(mappedState?.balance).toBe('9950');
        expect(mappedState?.totalReserved).toBe('450');
    });

});
