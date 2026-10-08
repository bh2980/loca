export interface TranslationIssue {
  code: string;
  message: string;
}

function tokensEqual(left: string[], right: string[]): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length
    && sortedLeft.every((token, index) => token === sortedRight[index]);
}

function tagsIn(text: string): string[] {
  // HTML and common game rich-text tags (including <color=#fff>).
  // A comparison such as "x < 3" is not treated as a tag.
  return text.match(/<\/?[A-Za-z](?:[^<>"']|"[^"]*"|'[^']*')*>/g) ?? [];
}

function linkTargets(tags: string[]): string[] {
  return tags.flatMap((tag) => Array.from(
    tag.matchAll(/\b(href|target)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi),
    (match) => `${match[1].toLowerCase()}=${match[2] ?? match[3] ?? match[4]}`,
  ));
}

/** Required mechanical checks only; numeric/semantic warnings belong elsewhere. */
export function validateTranslation(source: string, target: string): TranslationIssue[] {
  const issues: TranslationIssue[] = [];
  if (!target.trim()) {
    issues.push({ code: 'empty_translation', message: '번역문이 비어 있습니다.' });
  }

  const sourcePlaceholders = source.match(/\{[^{}\r\n]+\}/g) ?? [];
  const targetPlaceholders = target.match(/\{[^{}\r\n]+\}/g) ?? [];
  if (!tokensEqual(sourcePlaceholders, targetPlaceholders)) {
    issues.push({
      code: 'placeholder_mismatch',
      message: '자리표시자의 이름과 사용 횟수가 원문과 다릅니다.',
    });
  }

  const sourceTags = tagsIn(source);
  const targetTags = tagsIn(target);
  if (sourceTags.length !== targetTags.length
    || sourceTags.some((tag, index) => tag !== targetTags[index])) {
    issues.push({
      code: 'tag_mismatch',
      message: '서식 태그의 전체 토큰과 순서를 원문 그대로 보존해야 합니다.',
    });
  }
  if (!tokensEqual(linkTargets(sourceTags), linkTargets(targetTags))) {
    issues.push({
      code: 'link_target_mismatch',
      message: '링크의 href 또는 target 대상이 원문과 다릅니다.',
    });
  }
  return issues;
}
