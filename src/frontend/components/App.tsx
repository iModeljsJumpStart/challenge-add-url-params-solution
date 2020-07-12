/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { Config, Id64, Id64String, OpenMode } from "@bentley/bentleyjs-core";
import { ContextRegistryClient, Project } from "@bentley/context-registry-client";
import "@bentley/icons-generic-webfont/dist/bentley-icons-generic-webfont.css";
import { IModelQuery } from "@bentley/imodelhub-client";
import { AuthorizedFrontendRequestContext, DrawingViewState, FrontendRequestContext, IModelApp, IModelConnection, RemoteBriefcaseConnection, SpatialViewState, SelectionSetEvent, Viewport, EmphasizeElements, FeatureSymbology } from "@bentley/imodeljs-frontend";
import { SignIn, ViewportComponent } from "@bentley/ui-components";
import * as querystring from "querystring";
import * as url from "url";
import { Button, ButtonSize, ButtonType, Spinner, SpinnerSize } from "@bentley/ui-core";
import * as React from "react";
import { BasicViewportApp } from "../api/BasicViewportApp";
import "./App.css";
import Toolbar from "./Toolbar";
import { ColorDef } from "@bentley/imodeljs-common";

// cSpell:ignore imodels

/** React state of the App component */
export interface AppState {
  user: {
    isAuthorized: boolean;
    isLoading: boolean;
  };
  imodel?: IModelConnection;
  viewDefinitionId?: Id64String;
}

/** A component the renders the whole application UI */
export default class App extends React.Component<{}, AppState> {

  private _urlParams: any;

  /** Creates an App instance */
  constructor(props?: any, context?: any) {
    super(props, context);
    this.state = {
      user: {
        isAuthorized: BasicViewportApp.oidcClient.isAuthorized,
        isLoading: false,
      },
    };
    this._urlParams = this._getUrlParams();
  }

  public componentDidMount() {
    // Initialize authorization state, and add listener to changes
    BasicViewportApp.oidcClient.onUserStateChanged.addListener(this._onUserStateChanged);
  }

  public componentWillUnmount() {
    // unsubscribe from user state changes
    BasicViewportApp.oidcClient.onUserStateChanged.removeListener(this._onUserStateChanged);
  }

  private _onStartSignin = async () => {
    this.setState((prev) => ({ user: { ...prev.user, isLoading: true } }));
    BasicViewportApp.oidcClient.signIn(new FrontendRequestContext()); // tslint:disable-line:no-floating-promises
  }

  private _onUserStateChanged = () => {
    this.setState((prev) => ({ user: { ...prev.user, isAuthorized: BasicViewportApp.oidcClient.isAuthorized, isLoading: false } }));
  }

  private _getUrlParams() {
    const query = url.parse(document.URL).query;
    return query ? querystring.parse(query.toString()) : {};
  }

  private _getElementsIds() {
    return this._urlParams.elementIds ? this._urlParams.elementIds.split(" ") : [];
  }

  private _focusAndZoom(elements: any[], vp: Viewport) {
    const emphasize = EmphasizeElements.getOrCreate(vp);

    vp.zoomToElements(elements);
    emphasize.emphasizeElements(elements, vp, FeatureSymbology.Appearance.fromTransparency(0.95));
  }

  // get URL param values and execute corresponding functions.
  private _processUrlParams(vp: Viewport) {
    const elementIds = this._getElementsIds();
    if (elementIds.length > 0) this._focusAndZoom(elementIds, vp);
  }
  
  private _elementSelected =  async (ev: SelectionSetEvent) => {
    if (ev.set.elements.size === 1) {
      const sourceElementId = Array.from(ev.set.elements).pop();
      console.log("ID of selected element: " + sourceElementId);
    }
  }

  /** Pick the first available spatial view definition in the imodel */
  private async getFirstViewDefinitionId(imodel: IModelConnection): Promise<Id64String> {
    // Return default view definition (if any)
    const defaultViewId = await imodel.views.queryDefaultViewId();
    if (Id64.isValid(defaultViewId))
      return defaultViewId;

    // Return first spatial view definition (if any)
    const spatialViews: IModelConnection.ViewSpec[] = await imodel.views.getViewList({ from: SpatialViewState.classFullName });
    if (spatialViews.length > 0)
      return spatialViews[0].id!;

    // Return first drawing view definition (if any)
    const drawingViews: IModelConnection.ViewSpec[] = await imodel.views.getViewList({ from: DrawingViewState.classFullName });
    if (drawingViews.length > 0)
      return drawingViews[0].id!;

    throw new Error("No valid view definitions in imodel");
  }

  /** Handle iModel open event */
  private _onIModelSelected = async (imodel: IModelConnection | undefined) => {
    if (!imodel) {
      // reset the state when imodel is closed
      this.setState({ imodel: undefined, viewDefinitionId: undefined });
      return;
    }
    try {
      // once iModel has loaded, add one time listener to process URL params when view opens.
      IModelApp.viewManager.onViewOpen.addOnce( (vp: Viewport) => this._processUrlParams(vp));
      // attempt to get a view definition
      const viewDefinitionId = await this.getFirstViewDefinitionId(imodel);
      imodel.selectionSet.onChanged.addListener(this._elementSelected);
      this.setState({ imodel, viewDefinitionId });
    } catch (e) {
      // if failed, close the imodel and reset the state
      await imodel.close();
      this.setState({ imodel: undefined, viewDefinitionId: undefined });
      alert(e.message);
    }
  }

  private get _signInRedirectUri() {
    const split = (Config.App.get("imjs_browser_test_redirect_uri") as string).split("://");
    return split[split.length - 1];
  }

  /** The component's render method */
  public render() {
    let ui: React.ReactNode;

    if (this.state.user.isLoading || window.location.href.includes(this._signInRedirectUri)) {
      // if user is currently being loaded, just tell that
      ui = `signing-in...`;
    } else if (!this.state.user.isAuthorized) {
      // if user doesn't have and access token, show sign in page
      ui = (<SignIn onSignIn={this._onStartSignin} />);
    } else if (!this.state.imodel || !this.state.viewDefinitionId) {
      // if we don't have an imodel / view definition id - render a button that initiates imodel open
      ui = (<OpenIModelButton onIModelSelected={this._onIModelSelected} urlParams={this._urlParams} />);    } else {
      // if we do have an imodel and view definition id - render imodel components
      ui = (<IModelComponents imodel={this.state.imodel} viewDefinitionId={this.state.viewDefinitionId} />);
    }

    // render the app
    return (
      <div className="app">
        {ui}
      </div>
    );
  }
}

/** React props for [[OpenIModelButton]] component */
interface OpenIModelButtonProps {
  onIModelSelected: (imodel: IModelConnection | undefined) => void;
  urlParams: any;
}
/** React state for [[OpenIModelButton]] component */
interface OpenIModelButtonState {
  isLoading: boolean;
}
/** Renders a button that opens an iModel identified in configuration */
class OpenIModelButton extends React.PureComponent<OpenIModelButtonProps, OpenIModelButtonState> {
  public state = { isLoading: false };

  /** Finds project and imodel ids using their names */
  private async getIModelInfo(): Promise<{ projectId: string, imodelId: string }> {
    // get project and iModel name from URL params.
    const projectName = this.props.urlParams.projectName;
    const imodelName = this.props.urlParams.imodelName;

    if (!projectName || !imodelName)
    throw new Error("projectName or imodelName missing. \n\n 😱😱😱");

    const requestContext: AuthorizedFrontendRequestContext = await AuthorizedFrontendRequestContext.create();

    const connectClient = new ContextRegistryClient();
    let project: Project;
    try {
      project = await connectClient.getProject(requestContext, { $filter: `Name+eq+'${projectName}'` });
    } catch (e) {
      throw new Error(`Project with name "${projectName}" does not exist`);
    }

    const imodelQuery = new IModelQuery();
    imodelQuery.byName(imodelName);
    const imodels = await IModelApp.iModelClient.iModels.get(requestContext, project.wsgId, imodelQuery);
    if (imodels.length === 0)
      throw new Error(`iModel with name "${imodelName}" does not exist in project "${projectName}"`);
    return { projectId: project.wsgId, imodelId: imodels[0].wsgId };
  }

  /** Handle iModel open event */
  private async onIModelSelected(imodel: IModelConnection | undefined) {
    this.props.onIModelSelected(imodel);
    this.setState({ isLoading: false });
  }

  private _onClickOpen = async () => {
    this.setState({ isLoading: true });
    let imodel: IModelConnection | undefined;
    try {
      // attempt to open the imodel
      const info = await this.getIModelInfo();
      imodel = await RemoteBriefcaseConnection.open(info.projectId, info.imodelId, OpenMode.Readonly);
    } catch (e) {
      alert(e.message);
    }
    await this.onIModelSelected(imodel);
  }

  private _onClickSignOut = async () => {
    if (BasicViewportApp.oidcClient)
      BasicViewportApp.oidcClient.signOut(new FrontendRequestContext()); // tslint:disable-line:no-floating-promises
  }

  public render() {
    return (
      <div>
        <div>
          <Button size={ButtonSize.Large} buttonType={ButtonType.Primary} className="button-open-imodel" onClick={this._onClickOpen}>
            <span>Open iModel</span>
            {this.state.isLoading ? <span style={{ marginLeft: "8px" }}><Spinner size={SpinnerSize.Small} /></span> : undefined}
          </Button>
        </div>
        <div>
          <Button size={ButtonSize.Large} buttonType={ButtonType.Primary} className="button-signout" onClick={this._onClickSignOut}>
            <span>Sign Out</span>
          </Button>
        </div>
      </div>
    );
  }
}

/** React props for [[IModelComponents]] component */
interface IModelComponentsProps {
  imodel: IModelConnection;
  viewDefinitionId: Id64String;
}

/** Renders a viewport */
class IModelComponents extends React.PureComponent<IModelComponentsProps> {
  public render() {
    return (
      <>
        <ViewportComponent
          style={{ height: "100vh" }}
          imodel={this.props.imodel}
          viewDefinitionId={this.props.viewDefinitionId} />
        <Toolbar />
      </>
    );
  }
}
