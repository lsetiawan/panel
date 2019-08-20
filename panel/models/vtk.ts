import * as p from "core/properties"
import {clone} from "core/util/object";
import {HTMLBox, HTMLBoxView} from "models/layouts/html_box";
import {div} from "core/dom";


function majorAxis(vec3: number[], idxA: number, idxB: number): number[] {
  const axis = [0, 0, 0];
  const idx = Math.abs(vec3[idxA]) > Math.abs(vec3[idxB]) ? idxA : idxB;
  const value = vec3[idx] > 0 ? 1 : -1;
  axis[idx] = value;
  return axis;
}

export class VTKPlotView extends HTMLBoxView {
  model: VTKPlot
  protected _vtk: any
  protected _container: HTMLDivElement
  protected _rendererEl: any
  protected _renderer: any
  protected _camera: any
  protected _interactor: any
  protected _setting: boolean = false
  protected _orientationWidget: any

  initialize(): void {
    super.initialize()
    this._vtk = (window as any).vtk
    this._container = div({
      style: {
        width: "100%",
        height: "100%"
      }
    });
  }

  _create_orientation_widget(): void {
    const axes = this._vtk.Rendering.Core.vtkAxesActor.newInstance()

    // add orientation widget
    const orientationWidget = this._vtk.Interaction.Widgets.vtkOrientationMarkerWidget.newInstance({
      actor: axes,
      interactor: this._interactor,
    })
    orientationWidget.setEnabled(true)
    orientationWidget.setViewportCorner(
      this._vtk.Interaction.Widgets.vtkOrientationMarkerWidget.Corners.BOTTOM_RIGHT
    )
    orientationWidget.setViewportSize(0.15)
    orientationWidget.setMinPixelSize(100)
    orientationWidget.setMaxPixelSize(300)
    
    this._orientationWidget = orientationWidget

    const widgetManager = this._vtk.Widgets.Core.vtkWidgetManager.newInstance();
    widgetManager.setRenderer(orientationWidget.getRenderer());

    const widget = this._vtk.Widgets.Widgets3D.vtkInteractiveOrientationWidget.newInstance();
    widget.placeWidget(axes.getBounds());
    widget.setBounds(axes.getBounds());
    widget.setPlaceFactor(1);

    const vw = widgetManager.addWidget(widget);

    // Manage user interaction
    vw.onOrientationChange((inputs : any) => {
      const direction = inputs.direction
      const focalPoint = this._camera.getFocalPoint();
      const position = this._camera.getPosition();
      const viewUp = this._camera.getViewUp();

      const distance = Math.sqrt(
        Math.pow(position[0]-focalPoint[0],2) + Math.pow(position[1]-focalPoint[1],2) + Math.pow(position[2]-focalPoint[2],2)
      );

      this._camera.setPosition(
        focalPoint[0] + direction[0] * distance,
        focalPoint[1] + direction[1] * distance,
        focalPoint[2] + direction[2] * distance
      );

      if (direction[0]) {
        this._camera.setViewUp(majorAxis(viewUp, 1, 2));
      }
      if (direction[1]) {
        this._camera.setViewUp(majorAxis(viewUp, 0, 2));
      }
      if (direction[2]) {
        this._camera.setViewUp(majorAxis(viewUp, 0, 1));
      }

      this._orientationWidget.updateMarkerOrientation();
      // widgetManager.enablePicking();
      this._rendererEl.getRenderWindow().render()
    });
  }

  after_layout(): void {
    super.after_layout()
    if (!this._rendererEl) {
      this._rendererEl = this._vtk.Rendering.Misc.vtkFullScreenRenderWindow.newInstance({
        rootContainer: this.el,
        container: this._container
      });
      this._renderer = this._rendererEl.getRenderer()
      this._interactor = this._rendererEl.getInteractor()
      this._camera = this._renderer.getActiveCamera()

      this._plot()
      this._camera.onModified(() => this._get_camera_state())
      this._remove_default_key_binding()
      
      this._interactor.onRightButtonPress((_callData: any) => {
        console.log('Not Implemented')
      })
    }
  }

  connect_signals(): void {
    super.connect_signals()
    this.connect(this.model.properties.data.change, () => this._plot())
    this.connect(this.model.properties.camera.change, () => this._set_camera_state())
    this._container.addEventListener('mouseenter', () => {
      document.querySelector('body')!.addEventListener('keypress',this._interactor.handleKeyPress)
      document.querySelector('body')!.addEventListener('keydown',this._interactor.handleKeyDown)
      document.querySelector('body')!.addEventListener('keyup',this._interactor.handleKeyUp)
    })
    this._container.addEventListener('mouseleave', () => {
      document.querySelector('body')!.removeEventListener('keypress',this._interactor.handleKeyPress)
      document.querySelector('body')!.removeEventListener('keydown',this._interactor.handleKeyDown)
      document.querySelector('body')!.removeEventListener('keyup',this._interactor.handleKeyUp)
    })
  }

  _remove_default_key_binding(): void {
    document.querySelector('body')!.removeEventListener('keypress',this._interactor.handleKeyPress)
    document.querySelector('body')!.removeEventListener('keydown',this._interactor.handleKeyDown)
    document.querySelector('body')!.removeEventListener('keyup',this._interactor.handleKeyUp)
  }

  render() {
    super.render()
    if (!(this._container === this.el.childNodes[0]))
      this.el.appendChild(this._container)
  }

  _get_camera_state(): void {
    if (!this._setting) {
      this._setting = true;
      const state = clone(this._camera.get());
      delete state.classHierarchy;
      delete state.vtkObject;
      delete state.vtkCamera;
      delete state.viewPlaneNormal;
      this.model.camera = state;
      this._setting = false;
    }
  }

  _set_camera_state(): void {
    if (!this._setting) {
      this._setting = true;
      try {
        this._camera.set(this.model.camera);
      } finally {
        this._setting = false;
      }
      if (this._orientationWidget != null){
        this._orientationWidget.updateMarkerOrientation();
      }
      this._rendererEl.getRenderWindow().render();
    }
  }

  _plot(): void{
    if (!this.model.append) {
      this._delete_all_actors()
    }
    if (!this.model.data) {
      this._rendererEl.getRenderWindow().render()
      return
    }
    const dataAccessHelper = this._vtk.IO.Core.DataAccessHelper.get('zip', {
      zipContent: atob(this.model.data),
      callback: (_zip: any) => {
        const sceneImporter = this._vtk.IO.Core.vtkHttpSceneLoader.newInstance({
          renderer: this._rendererEl.getRenderer(),
          dataAccessHelper,
        })
        const fn = this._vtk.macro.debounce(() => {
          if (this._orientationWidget == null){
            this._create_orientation_widget()
          }
          this._rendererEl.getRenderWindow().render()
        }, 100)
        sceneImporter.setUrl('index.json')
        sceneImporter.onReady(fn)
      }
    })
  }

  _delete_all_actors(): void{
    this._renderer.getActors().map((actor: unknown) => this._renderer.removeActor(actor))
  }
}


export namespace VTKPlot {
  export type Attrs = p.AttrsOf<Props>
  export type Props = HTMLBox.Props & {
    data: p.Property<string>
    append: p.Property<boolean>
    camera: p.Property<any>
    enable_keybindings: p.Property<boolean>
  }
}

export interface VTKPlot extends VTKPlot.Attrs {}

export class VTKPlot extends HTMLBox {
  properties: VTKPlot.Props

  constructor(attrs?: Partial<VTKPlot.Attrs>) {
    super(attrs)
  }

  static initClass(): void {
    this.prototype.type = "VTKPlot"
    this.prototype.default_view = VTKPlotView

    this.define<VTKPlot.Props>({
      data:               [ p.String         ],
      append:             [ p.Boolean, false ],
      camera:             [ p.Any            ],
      enable_keybindings: [ p.Boolean, false ]
    })

    this.override({
      height: 300,
      width: 300
    });
  }
}
VTKPlot.initClass()
