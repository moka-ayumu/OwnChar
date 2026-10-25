import { useState, type ReactNode } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { isTelemetryOptedOut, setTelemetryOptOut } from '@/lib/telemetry';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/privacy')({ component: PrivacyPage });

const List = ({ items }: { items: string[] }) => (
	<ul className="list-disc space-y-1 pl-5">
		{items.map((item) => (
			<li key={item}>{item}</li>
		))}
	</ul>
);

/** Refuses collection on this browser, at once. */
function TelemetryOptOut() {
	const [optedOut, setOptedOut] = useState(isTelemetryOptedOut);
	const change = (next: boolean) => {
		setTelemetryOptOut(next);
		setOptedOut(next);
	};
	return (
		<div className="mt-6 flex items-center justify-between gap-4 rounded-md border border-rule px-4 py-3">
			<span id="opt-out" className="font-bold text-ink">
				오류 정보 수집 거부
			</span>
			<span className="flex items-center gap-3">
				<span className={cn('text-sm font-semibold', optedOut ? 'text-ink' : 'text-ink-3')}>{optedOut ? '거부 중' : '허용 중'}</span>
				<Switch checked={optedOut} onCheckedChange={change} aria-labelledby="opt-out" />
			</span>
		</div>
	);
}

/** The items Article 30 of the Personal Information Protection Act requires, for what the service does. */
const PRIVACY: Array<[string, ReactNode]> = [
	['1. 처리 목적', <List key="p" items={['오류 확인과 수정, 서비스 안정성 개선', '방문 현황과 페이지 성능 파악']} />],
	[
		'2. 처리하는 항목',
		<List
			key="i"
			items={[
				'오류 정보(Sentry): 오류의 종류와 메시지, 발생 위치, 앱 버전',
				'오류 직전의 이용 기록(Sentry): 화면 이동, 클릭한 요소, 네트워크 요청 주소, 콘솔 출력, 폰트 생성의 시작·완료·실패·취소, 폰트 다운로드, 생성에 사용된 그림 수와 문장 수',
				'기기·접속 환경(Sentry): 브라우저와 운영체제, 언어, 시간대, 페이지 주소와 이전 페이지 주소, 앱 사용 시간과 오류 발생 여부',
				'접속 기록(Cloudflare): IP 주소, 접속 일시, 요청한 주소, 브라우저 정보',
				'접속 통계(Cloudflare Web Analytics): 방문한 페이지 경로, 유입 경로, 국가, 기기 종류, 브라우저와 운영체제, 페이지 로딩 시간과 웹 성능 지표'
			]}
		/>
	],
	['3. 보유 및 이용 기간', <p key="r">Sentry로 수집하는 정보는 수집한 날부터 30일간 보유하며, 기간이 지나면 지체 없이 파기합니다. 접속 기록과 접속 통계는 서비스가 별도로 저장하지 않으며 4항의 Cloudflare 정책에 따릅니다.</p>],
	[
		'4. 처리 위탁 및 국외 이전',
		<>
			<p className="font-bold text-ink">Functional Software, Inc. (Sentry, 오류 분석)</p>
			<List
				key="g"
				items={[
					'위탁 업무: 오류 정보의 저장과 분석',
					'이전 국가: 미국',
					'이전 시기와 방법: 오류가 발생할 때 정보통신망을 통해 전송',
					'이전 항목: 2항의 오류 정보, 오류 직전의 이용 기록, 기기·접속 환경',
					'이용 목적과 보유 기간: 1항과 3항과 같습니다.',
					'거부 방법: 위의 오류 정보 수집 거부를 켭니다. 거부해도 서비스 이용에는 제한이 없습니다.'
				]}
			/>
			<p className="pt-2 font-bold text-ink">Cloudflare, Inc. (웹사이트 제공, 접속 통계)</p>
			<List
				key="c"
				items={[
					'위탁 업무: 웹사이트 호스팅과 전송, 보안, 접속 통계 (Cloudflare Pages, Web Analytics)',
					'이전 국가: 미국 (이용자와 가까운 Cloudflare 데이터센터에서 처리될 수 있습니다.)',
					'이전 시기와 방법: 서비스에 접속할 때 정보통신망을 통해 수시로 전송',
					'이전 항목: 2항의 접속 기록과 접속 통계',
					'이용 목적과 보유 기간: 웹사이트 제공, 보안, 방문 현황 파악을 위해 Cloudflare의 정책에 따라 보유합니다.',
					'거부 방법: 웹사이트 제공과 접속 통계에는 거부 수단이 없습니다. 거부하려면 서비스에 접속하지 않아야 합니다.'
				]}
			/>
		</>
	],
	['5. 파기 절차와 방법', <p key="d">보유 기간이 지난 정보는 수탁자의 저장소에서 자동으로 삭제되며, 복구할 수 없도록 처리됩니다.</p>],
	[
		'6. 이용자의 권리와 행사 방법',
		<>
			<p>이용자는 개인정보의 열람, 정정·삭제, 처리정지를 요청할 수 있습니다. 서비스는 이름이나 연락처를 수집하지 않으며, 수집한 정보를 이러한 정보와 연계하여 관리하지 않습니다.</p>
			<p>오류 정보 수집은 위의 오류 정보 수집 거부로 중단할 수 있습니다. 그 밖의 요청은 아래 개인정보 보호책임자에게 하시기 바랍니다.</p>
		</>
	],
	['7. 쿠키 등 자동 수집 장치', <p key="k">서비스는 쿠키를 사용하지 않습니다.</p>],
	['8. 안전성 확보 조치', <List key="s" items={['전송 구간 암호화(HTTPS)', '수집 정보에 대한 접근을 운영자로 제한']} />],
	['9. 개인정보 보호책임자', <List key="m" items={['성명: moka-ayumu (운영자)', '이메일: privacy+ownchar@mokaayumu.com']} />],
	['10. 처리방침의 변경', <p key="v">이 처리방침은 2026년 10월 25일부터 적용됩니다. 내용이 변경되면 이 페이지에 공개합니다.</p>]
];

function PrivacyPage() {
	return (
		<article className="mx-auto max-w-[68ch] px-8 py-12">
			<Link to="/" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-3')}>
				<ArrowLeft className="size-4" /> 돌아가기
			</Link>
			<h1 className="mt-8 text-[34px] font-extrabold tracking-[-0.03em]">개인정보처리방침</h1>
			<p className="mt-6 text-base leading-7 text-ink-2">
				OwnChar(이하 &quot;서비스&quot;)는 「개인정보 보호법」에 따라 이용자의 개인정보를 보호하고 관련 고충을 처리하기 위해 다음과 같이 처리방침을 공개합니다. 손글씨와 프로젝트는 이용자의 브라우저에만 저장되며 서버로 전송되지 않습니다.
			</p>
			<TelemetryOptOut />
			<div className="mt-10 space-y-6 border-t border-rule pt-6 text-base leading-7 text-ink-2">
				{PRIVACY.map(([title, body]) => (
					<section key={title}>
						<h2 className="font-bold text-ink">{title}</h2>
						<div className="mt-2 space-y-2">{body}</div>
					</section>
				))}
			</div>
		</article>
	);
}
