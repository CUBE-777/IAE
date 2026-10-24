import { Component } from 'react';
import ErrorScreen from './ErrorScreen';

/** شبكة أمان أخيرة لأي خطأ عرض خارج الراوتر (مثل AuthProvider). */
export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error('خطأ غير معالَج في التطبيق:', error);
  }

  render() {
    return this.state.failed ? <ErrorScreen /> : this.props.children;
  }
}
