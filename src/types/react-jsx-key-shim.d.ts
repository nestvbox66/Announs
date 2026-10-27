// El proyecto usa React 19 sin `@types/react`. El namespace JSX se resuelve
// vía `react-i18next`, que no declara `key` en `IntrinsicAttributes`; sin este
// parche, `key` en componentes con props tipadas produce TS2322.
import "react";

declare global {
  namespace JSX {
    interface IntrinsicAttributes {
      key?: string | number;
    }
  }
}

