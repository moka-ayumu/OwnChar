import { useEffect, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { downloadProjectArchive } from '@/project/archive';
import { projectStore } from '@/project/store';
import { useSaveStatus } from '@/project/use-project';

/**
 * A strip on the bottom edge while the browser refuses to keep the work. It stays until a save works
 * and does not blink off while the next attempt is in flight, so it can sit there through a whole
 * sentence of autosaves without calling for attention again.
 */
export function SaveFailedNotice() {
	const status = useSaveStatus();
	const [broken, setBroken] = useState(false);

	useEffect(() => {
		if (status === 'failed') setBroken(true);
		else if (status === 'saved') setBroken(false);
	}, [status]);

	if (!broken && status !== 'failed') return null;
	return (
		<div className="save-notice" role="alert">
			<TriangleAlert className="save-notice-icon size-4" aria-hidden="true" />
			<span>
				<strong>저장되지 않음</strong> 새로고침하면 사라집니다
			</span>
			<button type="button" onClick={() => downloadProjectArchive(projectStore.state)}>
				파일로 저장
			</button>
		</div>
	);
}
