import { unzip } from 'unzipit';

const self = globalThis as unknown as DedicatedWorkerGlobalScope;

addEventListener('message', (msg) => {
	const { data } = msg;
	switch (data.type) {
		case 'zip':
			loadZip(data.data).then((res) => {
				self.postMessage({ type: 'unzip', data: res });
			});
			break;

		default:
			break;
	}
});

export {};

function loadZip(zip: Blob): Promise<ImageBitmap[]> {
	return new Promise((resolve, reject) => {
		let datas: ImageBitmap[] = [];
		let successCount = 0;
		unzip(zip).then((info) => {
			const files = Object.values(info.entries);
			console.log(info);
			for (let i = 0; i < files.length; i++) {
				const file = files[i];
				if (file.name.endsWith('.jpg') || file.name.endsWith('.png')) {
					file.blob().then((blob) => {
						createImageBitmap(blob).then((bitmap) => {
							datas.push(bitmap);
							successCount++;
							if (successCount === files.length) {
								resolve(datas);
							}
						});
					});
				}
			}
		});
	});
}
