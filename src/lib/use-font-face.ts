import { useEffect, useState } from 'react';

export function useFontFace(buffer: ArrayBuffer | null, revision: number) {
	const [ready, setReady] = useState(false);

	useEffect(() => {
		if (!buffer) {
			return;
		}
		let disposed = false;
		const face = new FontFace('OwnCharPreview', buffer.slice(0));
		void face
			.load()
			.then((loaded) => {
				if (disposed) return;
				document.fonts.add(loaded);
				setReady(true);
			})
			.catch(() => setReady(false));
		return () => {
			disposed = true;
			document.fonts.delete(face);
		};
	}, [buffer, revision]);

	return Boolean(buffer) && ready;
}
