/* The chapters' staggered entrance: `.rise` elements fade up in order (--i) when their chapter becomes active. */
export default function Rise({ as: Tag = 'div', i = 0, className = '', style, children, ...rest }) {
  return <Tag className={'rise' + (className ? ' ' + className : '')} style={{ '--i': i, ...style }} {...rest}>{children}</Tag>;
}
