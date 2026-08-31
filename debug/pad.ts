// 패드 다이어그램 실측 — 기본 매핑 + 하이라이트(스킬 선택 버튼) 표본
import { DEFAULT_BINDINGS, type PadAction } from '../src/core/Gamepad';
import { padDiagramSvg } from '../src/render/GamepadUI';

const host = document.createElement('div');
host.innerHTML = padDiagramSvg((a: PadAction) => DEFAULT_BINDINGS[a], DEFAULT_BINDINGS.skillSelect);
document.body.appendChild(host);
