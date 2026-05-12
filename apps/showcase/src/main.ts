import { createApp } from 'vue';
import {
  Alert,
  Button,
  Card,
  Col,
  ConfigProvider,
  Descriptions,
  Divider,
  Layout,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography
} from 'ant-design-vue';
import VChart from 'vue-echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart, PieChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  ToolboxComponent
} from 'echarts/components';

import App from './App.vue';
import 'ant-design-vue/dist/reset.css';
import './style.css';

use([
  CanvasRenderer,
  BarChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  ToolboxComponent
]);

const app = createApp(App);
app.component('VChart', VChart);
app.use(ConfigProvider);
app.use(Layout);
app.use(Row);
app.use(Col);
app.use(Card);
app.use(Statistic);
app.use(Space);
app.use(Tag);
app.use(Alert);
app.use(Table);
app.use(Select);
app.use(Tabs);
app.use(Descriptions);
app.use(Button);
app.use(Divider);
app.use(Typography);
app.use(Tooltip);
app.use(Progress);
app.mount('#app');
