import { useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { EditSearch } from '@/features/editor/edit-page';

/** Opens the edit page with the same view transition every way in and out of it uses. */
export function useOpenEdit() {
	const navigate = useNavigate();
	return useCallback((search?: EditSearch) => void navigate({ to: '/edit', search, viewTransition: true }), [navigate]);
}
