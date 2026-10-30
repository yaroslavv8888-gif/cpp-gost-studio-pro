export type GostNodeType =
  | 'terminator'
  | 'predefined'
  | 'process'
  | 'io'
  | 'brace'
  | 'decision'
  | 'prep'
  | 'comment'
  | 'loop_start'
  | 'loop_end'
  | 'connector'
  | 'manual_op'
  | 'parallel'
  | 'striped_process'
  | 'omission'
  | 'stored_data'
  | 'ram'
  | 'seq_storage'
  | 'direct_storage'
  | 'document'
  | 'manual_input'
  | 'card'
  | 'paper_tape'
  | 'display';

export type PortSide = 'top' | 'bottom' | 'left' | 'right' | 'edge';

export type EdgeStyle =
  | 'ortho'
  | 'straight'
  | 'dashed'
  | 'control_transfer'
  | 'comm_link'
  | 'loop_left'
  | 'bypass_right';

export type CanvasTheme = 'whatman' | 'blueprint' | 'dark_drafting';

export interface FlowNode {
  /** Paired visual loop delimiters around the explicit condition topology. */
  loopBoundary?: boolean;
  /** Structured boundaries retained for editable, lossless C++ synthesis. */
  control?: {
    kind: 'if' | 'switch' | 'loop' | 'dowhile';
    joinId: string;
    bodyId?: string;
    conditionId?: string;
    keyword?: string;
    expression?: string;
    yesId?: string;
    noId?: string;
    cases?: { labels: string[]; labelIds?: string[]; hasBraces?: boolean; entryId: string; stopId: string }[];
  };
  /** Original C++ for compatibility with previously saved descriptive labels. */
  sourceText?: string;
  id: string;
  type: GostNodeType;
  text: string;
  cx: number;
  y: number;
  w: number;
  h: number;
  fnId?: string;
  sourceLines?: number[];
}

export interface FlowEdge {
  id: string;
  from: string | null;
  fromEdge: string | null;
  to: string | null;
  toEdge: string | null;
  fromPort: PortSide;
  toPort: PortSide;
  leftLabel: string;
  rightLabel: string;
  style: EdgeStyle;
  bendOffset: number;
  bendOffsetY?: number;
  waypoints?: { x: number; y: number }[];
}

export interface GostStampData {
  title: string;
  doc: string;
  code: string;
  author: string;
  group: string;
  teacher: string;
  date: string;
}

export interface CodeGenOptions {
  exampleStyle: boolean;
  showKeywords: boolean;
  gostLoopBounds: boolean;
  groupStmts: boolean;
  gostNumbers: boolean;
  autoSyncCpp: boolean;
}

export interface LaserGuide {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface GostIssue {
  id: string;
  severity: 'error' | 'warning' | 'ok';
  gostClause: string;
  title: string;
  description: string;
  nodeId?: string;
  edgeId?: string;
  fixType?:
    | 'add_decision_labels'
    | 'fix_comment_dashed'
    | 'separate_overlapping_nodes'
    | 'fill_empty_node_text'
    | 'connect_dangling_to_end'
    | 'add_start_terminator'
    | 'add_end_terminator'
    | 'match_loop_bounds';
}

export const LOOP_IF_CODE = `#include <iostream>
using namespace std;
int main()
{
    setlocale(LC_ALL, "Russian");
    int sum = 0;
    for (int i = 21; i < 100; i++) // запускаем цикл, i принимает значение от 21 до 99
    {
        if (i % 3 == 0) // проходит условие если i кратно 3, то
        {
            sum = sum + i; // к sum прибавляется текущее значение i
        }
    }
    cout << "Сумма целых положительных чисел, больших 20, меньших 100 и кратных 3 = " << sum << endl;
    return 0;
}`;

export const TRIANGLE_IF_CODE = `#include <iostream>
using namespace std;
#include <clocale>

int main()
{
    setlocale(LC_ALL, ".UTF8");
    int A, B, C;
    cin >> A >> B >> C;
    if ((A + B > C) && (A + C > B) && (B + C > A))
    {
        if (A == B || B == C || C == A)
        {
            if (A == B && B == C)
            {
                cout << "Равносторонний треугольник." << endl;
            }
            else
            {
                cout << "Равнобедренный треугольник." << endl;
            }
        }
        else
        {
            cout << "Разносторонний треугольник." << endl;
        }
    }
    else
    {
        cout << "Треугольник с такими сторонами не существует." << endl;
    }
    return 0;
}`;

export const EXAMPLE_CODE = `#include <iostream>
#include <clocale>
using namespace std;

int main()
{
    setlocale(LC_ALL, "Russian");
    double m, n;
    double res1, res2, res3;
    cout << "Введите m: ";
    cin >> m;
    cout << "Введите n: ";
    cin >> n;
    res1 = n++ * m;
    res2 = n++ < m;
    res3 = m-- > m;
    cout << "Результат n++ * m = " << res1 << endl;
    cout << "Результат n++ < m = " << res2 << endl;
    cout << "Результат m-- > m = " << res3 << endl;
    return 0;
}`;

export const COMPLEX_CPP_CODE = `#include <iostream>
#include <clocale>
using namespace std;

double calcSum(int n, double x)
{
    double s = 0;
    for (int i = 1; i <= n; i++)
    {
        if (i % 2 == 0)
        {
            s += x * i;
        }
        else
        {
            s -= x;
        }
    }
    return s;
}

int main()
{
    setlocale(LC_ALL, "Russian");
    int mode, n;
    double x, result = 0;
    cout << "Введите mode, n, x: ";
    cin >> mode >> n >> x;

    switch (mode)
    {
        case 1:
            if (n > 0)
            {
                result = calcSum(n, x);
            }
            else
            {
                result = -1;
            }
            break;
        case 2:
            result = x * x;
            break;
        default:
            result = 0;
            break;
    }

    cout << "Итог: " << result << endl;
    return 0;
}`;

export const SWITCH_CASE_CODE = `#include <iostream>
using namespace std;

int main()
{
    int a, sum = 100;
    cin >> a;
    switch (a)
    {
        case 1:
        case 2:
        case 3:
            cout << sum << endl;
            break;
        case 4:
            sum = sum * 2;
            cout << sum << endl;
            break;
        default:
            cout << 0 << endl;
            break;
    }
    return 0;
}`;

