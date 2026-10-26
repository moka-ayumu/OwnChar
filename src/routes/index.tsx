import { useRef, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowRight, ChevronDown, Eye, FolderOpen, Pause, PenLine, Play } from 'lucide-react';
import { useProjectFile } from '@/components/app-nav';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { useProject } from '@/project/use-project';
import { completedPromptCount, PROMPT_COUNT } from '@/collection/prompts';
import { clearPersistedProject } from '@/project/persistence';
import { projectActions } from '@/project/store';
import { HOME_SCENES } from '@/features/home/home-film';
import { useHomeFilm } from '@/features/home/use-home-film';
import { loadSampleProject } from '@/features/samples/sample-projects';

export const Route = createFileRoute('/')({ component: HomePage });

function HomePage() {
	const navigate = useNavigate();
	const state = useProject((project) => project);
	const completed = completedPromptCount(state.drawings);
	const canResume = state.status !== 'empty' && (completed > 0 || state.generatedFont);
	const file = useProjectFile();
	const [loadingSample, setLoadingSample] = useState(false);
	const canvas = useRef<HTMLCanvasElement>(null);
	const foot = useRef<HTMLDivElement>(null);
	const film = useHomeFilm(canvas, foot);

	const start = async () => {
		if (canResume && !window.confirm('현재 작업을 지우고 새로 시작하시겠습니까?')) return;
		await clearPersistedProject();
		projectActions.startProject();
		void navigate({ to: '/write' });
	};

	const openSample = async () => {
		if (canResume && !window.confirm('현재 작업을 지우고 예시 손글씨를 불러오시겠습니까?')) return;
		setLoadingSample(true);
		try {
			await loadSampleProject();
			void navigate({ to: '/write' });
		} finally {
			setLoadingSample(false);
		}
	};

	return (
		<section className="home">
			<canvas ref={canvas} className="film" aria-hidden="true" />
			<div ref={foot} className="home-foot">
				<div className="home-panel">
					<h1>문장 8개로 나만의 손글씨 폰트를 만드세요.</h1>
					<div className="home-actions">
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button disabled={loadingSample}>
									{loadingSample ? (
										'불러오는 중…'
									) : (
										<>
											<PenLine className="size-4" /> 시작하기 <ChevronDown className="size-4" />
										</>
									)}
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="start">
								<DropdownMenuItem onSelect={() => void start()}>
									<PenLine className="size-4" /> 새로 만들기
								</DropdownMenuItem>
								<DropdownMenuItem onSelect={file.pick}>
									<FolderOpen className="size-4" /> 불러오기
								</DropdownMenuItem>
								<DropdownMenuItem onSelect={() => void openSample()}>
									<Eye className="size-4" /> 예시 손글씨 구경하기
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
						{file.fileInput}
						{canResume && (
							<Button variant="secondary" onClick={() => void navigate({ to: state.status === 'ready' ? '/preview' : '/write' })}>
								이어서 만들기 <ArrowRight className="size-4" />
							</Button>
						)}
					</div>

					{canResume && (
						<div className="home-resume">
							<span className="font-bold">현재 작업</span>
							<Progress value={(completed / PROMPT_COUNT) * 100} />
							<span className="tnum font-semibold text-ink-2">
								{completed} / {PROMPT_COUNT}
							</span>
						</div>
					)}
				</div>

				<nav className="home-scenes" aria-label="만드는 과정">
					<div className="home-scenes-head">
						<span>만드는 과정</span>
						{!film.still && (
							<Button variant="ghost" size="icon" aria-label={film.paused ? '재생' : '일시정지'} onClick={film.toggle}>
								{film.paused ? <Play className="size-4" /> : <Pause className="size-4" />}
							</Button>
						)}
					</div>
					<ol>
						{HOME_SCENES.map((item, index) => (
							<li key={item.name}>
								<button aria-current={index === film.scene ? 'step' : undefined} onClick={() => film.seek(index)}>
									<span>{index + 1}</span>
									<span>{item.name}</span>
								</button>
							</li>
						))}
					</ol>
					<p>{HOME_SCENES[film.scene].note}</p>
				</nav>
			</div>
		</section>
	);
}
