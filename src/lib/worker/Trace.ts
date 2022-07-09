const self = globalThis as unknown as DedicatedWorkerGlobalScope;

import ImageTracer from 'imagetracerjs';

addEventListener('message', (msg) => {
	const { data } = msg;
	switch (data.type) {
		case 'trace':
			const res = trace(data.data);
			self.postMessage({ type: 'tracedata', id: data.id, data: res, pos: data.pos });
			break;

		default:
			break;
	}
});

export {};

function trace(data: ImageData) {
	const options = {
		colorsampling: 0,
		colorquantcycles: 1,
		numberofcolors: 2,
		blurradius: 5,
		blurdelta: 128,
		// pathomit: 0,
		ltres: 0.01,
		qtres: 0.01,
		linefilter: false
	};

	const res = ImageTracer.imagedataToTracedata(data, options);

	return res;
}
