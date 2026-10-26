import ReactDOM from 'react-dom/client';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { initializeTelemetry, reportError, reportRenderError, setView } from '@/lib/telemetry';
import { initializePersistence } from '@/project/persistence';
import { routeTree } from './routeTree.gen';
import '@fontsource-variable/noto-sans-kr/wght.css';
import '@fontsource/ibm-plex-sans-kr/700.css';
import './styles.css';

const router = createRouter({
	routeTree,
	defaultPreload: 'intent',
	defaultOnCatch: (error) => reportError('RENDER_FAILED', error)
});

declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router;
	}
}

initializeTelemetry();
router.subscribe('onResolved', ({ toLocation }) => setView(toLocation.pathname));
void initializePersistence();

ReactDOM.createRoot(document.getElementById('root')!, { onUncaughtError: reportRenderError }).render(<RouterProvider router={router} />);
