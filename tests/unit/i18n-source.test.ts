import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { MESSAGES } from '../../apps/admin/src/lib/i18n/messages';

const root = 'apps/admin/src';
const files = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)],
    )
    .filter((file) => file.endsWith('.tsx'));

it('keeps frontend translation references connected and translated options explicit', () => {
  const violations: string[] = [];
  for (const file of files(root)) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (node: ts.Node) => {
      const fail = (reason: string) =>
        violations.push(
          `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${reason}`,
        );
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 't'
      ) {
        const key = node.arguments[0];
        if (key && ts.isStringLiteral(key) && !(key.text in MESSAGES))
          fail(`Missing translation: ${key.text}`);
        if (key && ts.isStringLiteral(key) && key.text in MESSAGES) {
          const entry = MESSAGES[key.text as keyof typeof MESSAGES];
          const required = [...entry.en.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!);
          const params = node.arguments[1];
          if (required.length && !params) fail(`Missing interpolation parameters: ${key.text}`);
          if (params && ts.isObjectLiteralExpression(params)) {
            const provided = params.properties.map((property) => property.name?.getText(source));
            if (required.some((name) => !provided.includes(name)))
              fail(`Incomplete interpolation parameters: ${key.text}`);
          }
        }
      }
      if (
        ts.isJsxOpeningElement(node) &&
        node.tagName.getText(source) === 'option' &&
        !node.attributes.properties.some(
          (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'value',
        )
      ) {
        fail('Options must preserve explicit internal values');
      }
      if (ts.isJsxText(node)) {
        const text = node.text.trim();
        // Brand and international technical identifiers are deliberately not translated.
        if (/[a-zA-Z]{2}/.test(text) && !['FastFood Riza', 'SKU'].includes(text))
          fail(`Hardcoded display text: ${text}`);
      }
      if (
        ts.isJsxAttribute(node) &&
        ['title', 'placeholder', 'aria-label', 'alt'].includes(node.name.getText(source)) &&
        node.initializer &&
        ts.isStringLiteral(node.initializer)
      ) {
        const text = node.initializer.text;
        if (/[a-zA-Z]{2}/.test(text) && !['FastFood Riza', 'SKU', 'https://'].includes(text)) {
          fail(`Hardcoded accessible/display label: ${text}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(violations).toEqual([]);
});
