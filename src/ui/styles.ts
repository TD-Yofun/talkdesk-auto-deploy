/**
 * Sass styles compiled by Vite and injected through Tampermonkey.
 */
import styles from './styles.scss?inline';

export function injectStyles(): void {
  GM_addStyle(styles);
}
